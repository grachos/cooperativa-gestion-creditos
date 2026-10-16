import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { creditApplicationSchema, decisionSchema, idParam, paginationQuery, reviewItemSchema } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";
import { idempotent } from "../../middlewares/idempotent.js";

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

async function transition(
  applicationId: number,
  fromStatus: string,
  toStatus: string,
  userId: number,
  reason?: string | null
) {
  await pool.query(`UPDATE credit_applications SET status = ? WHERE id = ?`, [toStatus, applicationId]);
  await pool.query(
    `INSERT INTO credit_application_status_history (credit_application_id, from_status, to_status, reason, user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [applicationId, fromStatus, toStatus, reason ?? null, userId]
  );
}

applicationsRouter.get(
  "/",
  requirePermission("applications:read"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const status = req.query.status as string | undefined;
    const search = (req.query.search as string | undefined)?.trim().slice(0, 80);
    const offset = (page - 1) * pageSize;

    // Búsqueda por cédula/NIT (prefijo), nombre del titular, razón social o número de solicitud.
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (status) {
      conditions.push(`ca.status = ?`);
      args.push(status);
    }
    if (search) {
      conditions.push(
        `(a.id_number LIKE ? OR CONCAT(a.first_name, ' ', a.last_name) LIKE ? OR s.legal_name LIKE ? OR s.tax_id_number LIKE ? OR ca.id = ?)`
      );
      args.push(`${search}%`, `%${search}%`, `%${search}%`, `${search}%`, /^\d+$/.test(search) ? Number(search) : 0);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const fromJoin = `FROM credit_applications ca
       LEFT JOIN associates a ON a.id = ca.titular_associate_id
       LEFT JOIN societies s ON s.id = ca.titular_society_id`;

    const [rows] = await pool.query<any[]>(
      `SELECT ca.*, a.first_name, a.last_name, a.id_number, s.legal_name
       ${fromJoin}
       ${where} ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total ${fromJoin} ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

/**
 * Crea (si faltan) una fila PENDIENTE por cada documento que se exige a cada
 * participante: los de `documentos_requeridos_titular` para el titular y los de
 * `documentos_requeridos_codeudor` para cada codeudor. Así la solicitud siempre
 * refleja la lista vigente, incluso si el parámetro cambió después de radicarla.
 *
 * Las solicitudes anteriores a este cambio tienen documentos "de la solicitud"
 * (sin participante) de la lista única `documentos_requeridos`: se dejan como
 * están, sin mezclar ambos modelos.
 */
async function ensureRequiredDocuments(applicationId: number) {
  const [legacy] = await pool.query<any[]>(
    `SELECT 1 FROM credit_application_documents WHERE credit_application_id = ? AND credit_participant_id IS NULL LIMIT 1`,
    [applicationId]
  );
  if ((legacy as any[]).length > 0) return;

  const [paramRows] = await pool.query<any[]>(
    `SELECT \`key\`, value FROM parameters
     WHERE \`key\` IN ('documentos_requeridos_titular', 'documentos_requeridos_codeudor', 'documentos_requeridos')`
  );
  const params = new Map((paramRows as any[]).map((r) => [r.key as string, r.value]));
  const listFor = (key: string): string[] => {
    const v = params.get(key) ?? params.get("documentos_requeridos");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  };
  const byRole: Record<string, string[]> = {
    TITULAR: listFor("documentos_requeridos_titular"),
    CODEUDOR: listFor("documentos_requeridos_codeudor")
  };

  const [participants] = await pool.query<any[]>(
    `SELECT id, role FROM credit_participants WHERE credit_application_id = ?`,
    [applicationId]
  );
  for (const participant of participants as any[]) {
    for (const documentType of byRole[participant.role] ?? []) {
      // La llave única (solicitud, participante, documento) evita duplicados si dos peticiones coinciden.
      await pool.query(
        `INSERT IGNORE INTO credit_application_documents (credit_application_id, credit_participant_id, document_type)
         VALUES (?, ?, ?)`,
        [applicationId, participant.id, documentType]
      );
    }
  }
}

applicationsRouter.get(
  "/:id",
  requirePermission("applications:read"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(
      `SELECT ca.*, cu.full_name AS created_by_name, du.full_name AS decided_by_name, sel.full_name AS seller_name
       FROM credit_applications ca
       LEFT JOIN users sel ON sel.id = ca.assigned_seller_id
       LEFT JOIN users cu ON cu.id = ca.created_by
       LEFT JOIN users du ON du.id = ca.decided_by
       WHERE ca.id = ?`,
      [id]
    );
    const application = (rows as any[])[0];
    if (!application) throw new HttpError(404, "Solicitud no encontrada");

    await ensureRequiredDocuments(id);

    // Trazabilidad: cada revisión, decisión y cambio de estado muestra quién lo hizo.
    const [participants] = await pool.query<any[]>(
      `SELECT cp.*, a.first_name, a.last_name, ru.full_name AS reviewed_by_name FROM credit_participants cp
       LEFT JOIN associates a ON a.id = cp.associate_id
       LEFT JOIN users ru ON ru.id = cp.reviewed_by
       WHERE cp.credit_application_id = ?`,
      [id]
    );
    const [documents] = await pool.query<any[]>(
      `SELECT d.*, ru.full_name AS reviewed_by_name FROM credit_application_documents d
       LEFT JOIN users ru ON ru.id = d.reviewed_by
       WHERE d.credit_application_id = ? ORDER BY d.id ASC`,
      [id]
    );
    const [history] = await pool.query<any[]>(
      `SELECT h.*, u.full_name AS user_name FROM credit_application_status_history h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.credit_application_id = ? ORDER BY h.created_at ASC, h.id ASC`,
      [id]
    );
    const [references] = await pool.query<any[]>(
      `SELECT r.*, u.full_name AS checked_by_name FROM application_reference_checks r
       LEFT JOIN users u ON u.id = r.checked_by
       WHERE r.credit_application_id = ? ORDER BY r.id ASC`,
      [id]
    );

    res.json({ ...application, participants, documents, history, references });
  })
);

applicationsRouter.put(
  "/:id/documents/:documentId",
  requirePermission("applications:review"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const documentId = z.coerce.number().int().positive().parse(req.params.documentId);
    const { status, notes } = reviewItemSchema.parse(req.body);

    const [appRows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (appRows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no está en un estado que permita revisar documentos");
    }

    const [docRows] = await pool.query<any[]>(
      `SELECT * FROM credit_application_documents WHERE id = ? AND credit_application_id = ?`,
      [documentId, id]
    );
    if ((docRows as any[]).length === 0) throw new HttpError(404, "Documento no encontrado");

    await pool.query(
      `UPDATE credit_application_documents SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [status, notes ?? null, req.user!.id, documentId]
    );

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "DOCUMENT_REVIEW",
      newValue: { documentId, documentType: (docRows as any[])[0].document_type, status, notes },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id: documentId, status });
  })
);

applicationsRouter.put(
  "/:id/participants/:participantId",
  requirePermission("applications:review"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const participantId = z.coerce.number().int().positive().parse(req.params.participantId);
    const { status, notes } = reviewItemSchema.parse(req.body);

    const [appRows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (appRows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no está en un estado que permita revisar participantes");
    }

    const [partRows] = await pool.query<any[]>(
      `SELECT * FROM credit_participants WHERE id = ? AND credit_application_id = ?`,
      [participantId, id]
    );
    const participant = (partRows as any[])[0];
    if (!participant) throw new HttpError(404, "Participante no encontrado");

    await pool.query(
      `UPDATE credit_participants SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [status, notes ?? null, req.user!.id, participantId]
    );

    // Un asociado rechazado como participante no debe poder elegirse como
    // titular/codeudor en una solicitud nueva (ver GET /associates?selectable=true).
    // Si la revisión se corrige más adelante, se reactiva — pero solo si
    // sigue en RECHAZADO (no se pisa un INACTIVO puesto por otro motivo).
    if (participant.associate_id) {
      if (status === "RECHAZADO") {
        await pool.query(`UPDATE associates SET status = 'RECHAZADO' WHERE id = ?`, [participant.associate_id]);
        await recordAudit(pool, {
          entity: "associate",
          entityId: participant.associate_id,
          action: "STATUS_CHANGE",
          newValue: { status: "RECHAZADO", reason: `Rechazado como participante en la solicitud #${id}` },
          userId: req.user!.id,
          ipAddress: req.ip
        });
      } else {
        await pool.query(
          `UPDATE associates SET status = 'ACTIVO' WHERE id = ? AND status = 'RECHAZADO'`,
          [participant.associate_id]
        );
      }
    }

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "PARTICIPANT_REVIEW",
      newValue: { participantId, role: participant.role, status, notes },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id: participantId, status });
  })
);

applicationsRouter.post(
  "/",
  requirePermission("applications:write"),
  idempotent("applications.create"),
  asyncHandler(async (req, res) => {
    const data = creditApplicationSchema.parse(req.body);
    if (!data.titularAssociateId && !data.titularSocietyId) {
      throw new HttpError(400, "Debe indicar un titular (asociado o sociedad)");
    }

    if (data.assignedSellerId) {
      const [sellerRows] = await pool.query<any[]>(`SELECT id FROM users WHERE id = ? AND status = 'ACTIVO'`, [data.assignedSellerId]);
      if ((sellerRows as any[]).length === 0) throw new HttpError(400, "El asesor indicado no existe o está inactivo");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO credit_applications
        (titular_associate_id, titular_society_id, requested_amount, term_value, interest_rate, rate_type, expected_disbursement_date, due_day_rule, purpose, notes, assigned_seller_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RADICADA', ?)`,
      [
        data.titularAssociateId ?? null,
        data.titularSocietyId ?? null,
        data.requestedAmount,
        data.termValue,
        data.interestRate,
        data.rateType,
        data.expectedDisbursementDate ?? null,
        data.dueDayRule ?? null,
        data.purpose ?? null,
        data.notes ?? null,
        data.assignedSellerId ?? null,
        req.user!.id
      ]
    );
    const applicationId = result.insertId;

    await pool.query(
      `INSERT INTO credit_participants (credit_application_id, associate_id, society_id, role) VALUES (?, ?, ?, 'TITULAR')`,
      [applicationId, data.titularAssociateId ?? null, data.titularSocietyId ?? null]
    );

    for (const coDebtorId of data.coDebtorAssociateIds ?? []) {
      await pool.query(
        `INSERT INTO credit_participants (credit_application_id, associate_id, role) VALUES (?, ?, 'CODEUDOR')`,
        [applicationId, coDebtorId]
      );
    }

    await transition(applicationId, "BORRADOR", "RADICADA", req.user!.id, "Radicación inicial");
    await recordAudit(pool, {
      entity: "credit_application",
      entityId: applicationId,
      action: "CREATE",
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.created", { id: applicationId });
    res.status(201).json({ id: applicationId });
  })
);

const referenceSchema = z.object({
  referenceType: z.enum(["PERSONAL", "LABORAL"]),
  referenceName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().nullable(),
  contacted: z.boolean().default(false),
  result: z.enum(["POSITIVA", "NEGATIVA", "SIN_RESPUESTA"]).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

// Verificación de referencias: quién las llamó, si contestaron y si fueron positivas o negativas.
async function loadOpenApplication(id: number) {
  const [rows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
  const app = (rows as any[])[0];
  if (!app) throw new HttpError(404, "Solicitud no encontrada");
  if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
    throw new HttpError(409, "La solicitud no está en un estado que permita verificar referencias");
  }
}

applicationsRouter.post(
  "/:id/references",
  requirePermission("applications:review"),
  idempotent("applications.reference"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = referenceSchema.parse(req.body);
    if (data.contacted && !data.result) throw new HttpError(400, "Indique el resultado de la verificación");
    await loadOpenApplication(id);
    const [result] = await pool.query<any>(
      `INSERT INTO application_reference_checks
         (credit_application_id, reference_type, reference_name, phone, contacted, result, notes, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.referenceType, data.referenceName, data.phone || null, data.contacted ? 1 : 0, data.contacted ? data.result : null, data.notes || null, req.user!.id]
    );
    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "REFERENCE_CHECK",
      newValue: { referenceId: result.insertId, ...data },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.status(201).json({ id: result.insertId });
  })
);

applicationsRouter.put(
  "/:id/references/:referenceId",
  requirePermission("applications:review"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const referenceId = z.coerce.number().int().positive().parse(req.params.referenceId);
    const data = referenceSchema.parse(req.body);
    if (data.contacted && !data.result) throw new HttpError(400, "Indique el resultado de la verificación");
    await loadOpenApplication(id);
    const [result] = await pool.query<any>(
      `UPDATE application_reference_checks
       SET reference_type = ?, reference_name = ?, phone = ?, contacted = ?, result = ?, notes = ?, checked_by = ?
       WHERE id = ? AND credit_application_id = ?`,
      [data.referenceType, data.referenceName, data.phone || null, data.contacted ? 1 : 0, data.contacted ? data.result : null, data.notes || null, req.user!.id, referenceId, id]
    );
    if (!result.affectedRows) throw new HttpError(404, "Referencia no encontrada");
    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "REFERENCE_CHECK",
      newValue: { referenceId, ...data },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id: referenceId });
  })
);

applicationsRouter.post(
  "/:id/review",
  requirePermission("applications:review"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (app.status !== "RADICADA") throw new HttpError(409, "La solicitud no está en estado radicada");

    await transition(id, app.status, "EN_REVISION", req.user!.id, "Inicio de revisión");
    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "REVIEW_START",
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id, status: "EN_REVISION" });
  })
);

applicationsRouter.post(
  "/:id/approve",
  requirePermission("applications:approve"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const decision = decisionSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede aprobarse en su estado actual");
    }

    await ensureRequiredDocuments(id);
    const [pendingDocs] = await pool.query<any[]>(
      `SELECT d.document_type, cp.role FROM credit_application_documents d
       LEFT JOIN credit_participants cp ON cp.id = d.credit_participant_id
       WHERE d.credit_application_id = ? AND d.status != 'APROBADO'`,
      [id]
    );
    const [pendingParticipants] = await pool.query<any[]>(
      `SELECT role FROM credit_participants WHERE credit_application_id = ? AND status != 'APROBADO'`,
      [id]
    );
    if ((pendingDocs as any[]).length > 0 || (pendingParticipants as any[]).length > 0) {
      const missing = [
        ...(pendingDocs as any[]).map((d) => `documento "${d.document_type}"${d.role ? ` (${d.role})` : ""}`),
        ...(pendingParticipants as any[]).map((p) => `participante (${p.role})`)
      ];
      throw new HttpError(409, `Faltan por aprobar: ${missing.join(", ")}`);
    }

    await pool.query(
      `UPDATE credit_applications SET
        requested_amount = COALESCE(?, requested_amount),
        interest_rate = COALESCE(?, interest_rate),
        term_value = COALESCE(?, term_value),
        decided_by = ?, decided_at = NOW()
       WHERE id = ?`,
      [
        decision.approvedAmount ?? null,
        decision.approvedRate ?? null,
        decision.approvedTerm ?? null,
        req.user!.id,
        id
      ]
    );
    await transition(id, app.status, "APROBADA", req.user!.id, decision.observations ?? "Aprobada");

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "APPROVE",
      oldValue: app,
      newValue: decision,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.status_changed", { id, status: "APROBADA" });
    res.json({ id, status: "APROBADA" });
  })
);

applicationsRouter.post(
  "/:id/reject",
  requirePermission("applications:approve"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const decision = decisionSchema.parse(req.body);
    if (!decision.rejectionReason) throw new HttpError(400, "Debe indicar el motivo de rechazo");

    const [rows] = await pool.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede rechazarse en su estado actual");
    }

    await pool.query(
      `UPDATE credit_applications SET rejection_reason = ?, decided_by = ?, decided_at = NOW() WHERE id = ?`,
      [decision.rejectionReason, req.user!.id, id]
    );
    await transition(id, app.status, "RECHAZADA", req.user!.id, decision.rejectionReason);

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "REJECT",
      oldValue: app,
      newValue: decision,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.status_changed", { id, status: "RECHAZADA" });
    res.json({ id, status: "RECHAZADA" });
  })
);

applicationsRouter.post(
  "/:id/cancel",
  requirePermission("applications:cancel"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (["DESEMBOLSADA", "CANCELADA"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede cancelarse en su estado actual");
    }
    await transition(id, app.status, "CANCELADA", req.user!.id, req.body?.reason ?? "Cancelada por usuario");
    res.json({ id, status: "CANCELADA" });
  })
);
