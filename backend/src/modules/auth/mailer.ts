import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Coomulnissi · Restablecer contraseña";
  const text = `Recibimos una solicitud para restablecer tu contraseña.\n\nAbre este enlace para elegir una nueva (vence en 1 hora):\n${resetUrl}\n\nSi no fuiste tú, ignora este correo.`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#7e4875">Coomulnissi</h2>
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#a85a93;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Elegir nueva contraseña</a></p>
      <p style="color:#64748b;font-size:12px">Este enlace vence en 1 hora. Si no fuiste tú, ignora este correo.</p>
    </div>`;

  const client = getTransporter();
  if (!client) {
    // Sin SMTP configurado (p. ej. en desarrollo): se deja el enlace en
    // consola para poder probar el flujo completo sin credenciales reales.
    console.log(`[mailer] SMTP no configurado — enlace de restablecimiento para ${to}:\n${resetUrl}`);
    return;
  }

  await client.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
}
