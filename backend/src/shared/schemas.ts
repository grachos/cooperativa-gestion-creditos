import { z } from "zod";

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(6)
});

export const associateSchema = z.object({
  idType: z.enum(["CC", "CE", "TI", "PA", "NIT"]),
  idNumber: z.string().min(4).max(40),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  birthDate: z.string().date().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  municipality: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional(),
  incomeInfo: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  dataConsent: z.boolean().optional()
});

export const societySchema = z.object({
  taxIdType: z.enum(["NIT"]),
  taxIdNumber: z.string().min(4).max(40),
  legalName: z.string().min(1).max(160),
  tradeName: z.string().max(160).optional().nullable(),
  legalRepresentativeAssociateId: z.coerce.number().int().positive().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  economicActivity: z.string().max(160).optional().nullable(),
  notes: z.string().optional().nullable()
});

export const creditApplicationSchema = z.object({
  titularAssociateId: z.coerce.number().int().positive().optional().nullable(),
  titularSocietyId: z.coerce.number().int().positive().optional().nullable(),
  coDebtorAssociateIds: z.array(z.coerce.number().int().positive()).optional(),
  requestedAmount: z.coerce.number().positive(),
  termValue: z.coerce.number().int().positive(),
  interestRate: z.coerce.number().positive(),
  rateType: z.enum(["NOMINAL_MENSUAL", "EFECTIVA_ANUAL"]).default("NOMINAL_MENSUAL"),
  expectedDisbursementDate: z.string().date().optional().nullable(),
  dueDayRule: z.string().optional().nullable(),
  purpose: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable()
});

export const decisionSchema = z.object({
  approvedAmount: z.coerce.number().positive().optional(),
  approvedRate: z.coerce.number().positive().optional(),
  approvedTerm: z.coerce.number().int().positive().optional(),
  observations: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable()
});

export const disbursementSchema = z.object({
  disbursementDate: z.string().date(),
  firstInstallmentDate: z.string().date(),
  assignedCollectorId: z.coerce.number().int().positive().optional().nullable(),
  assignedSellerId: z.coerce.number().int().positive().optional().nullable(),
  // Hallazgo del Excel real: crédito fondeado por un tercero ("tomador") que
  // recibe una tasa menor que la que paga el asociado. Opcional: si no se
  // envía, el crédito se asume fondeado con capital propio de la cooperativa.
  funderName: z.string().trim().min(1).max(255).optional().nullable(),
  funderRatePercent: z.coerce.number().min(0).optional().nullable()
});

export const refinanceSchema = z.object({
  additionalCapital: z.coerce.number().min(0).default(0),
  termValue: z.coerce.number().int().positive(),
  interestRate: z.coerce.number().positive(),
  firstInstallmentDate: z.string().date(),
  reason: z.string().min(3).max(255)
});

export const adjustmentSchema = z.object({
  type: z.enum(["INTERES_CAMBIO_FECHA", "DESCUENTO", "GASTO_NOTIFICACION", "OTRO"]),
  installmentId: z.coerce.number().int().positive().optional().nullable(),
  amount: z.coerce.number(),
  reason: z.string().min(3).max(255)
});

export const promiseSchema = z.object({
  promiseDate: z.string().date(),
  description: z.string().max(255).optional().nullable()
});

export const paymentSchema = z.object({
  creditId: z.coerce.number().int().positive(),
  receivedDate: z.string().date(),
  effectiveDate: z.string().date().optional().nullable(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.string().min(1).max(60),
  reference: z.string().max(120).optional().nullable(),
  notes: z.string().max(255).optional().nullable()
});

export const reversalSchema = z.object({
  reason: z.string().min(3).max(255)
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const createUserSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email().max(160),
  username: z.string().min(3).max(80),
  password: z.string().min(8).max(72),
  roleCodes: z.array(z.string()).optional().default([])
});

export const updateUserSchema = z.object({
  status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
  roleCodes: z.array(z.string()).optional(),
  password: z.string().min(8).max(72).optional()
});
