import nodemailer from 'nodemailer';
import { resolve4 } from 'node:dns/promises';

const NOTIFY_EMAIL = 'lampardronaldo1@gmail.com';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USER = 'lampardronaldo1@gmail.com';
const SMTP_PASS = 'obcnjdxsluabhszk';
const SMTP_FROM = 'lampardronaldo1@gmail.com';

// Railway blocks outbound SMTP and has no IPv6, so use SendGrid/Resend/etc. over HTTPS in prod.
// To keep using SMTP, the transport resolves the host to an IPv4 address and uses SNI.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_FROM;

// Try 465 (SSL) first, then 587 (STARTTLS): some hosts block one but not the other.
const SMTP_PORTS = [465, 587];

let transporter = null;

async function resolveIPv4Host() {
  try {
    const addresses = await resolve4(SMTP_HOST);
    if (addresses.length) {
      console.log(`[mafia] resolved ${SMTP_HOST} to IPv4 ${addresses[0]}`);
      return addresses[0];
    }
  } catch (err) {
    console.warn(`[mafia] could not resolve IPv4 for ${SMTP_HOST}:`, err.message);
  }
  return SMTP_HOST;
}

function createTransporterForPort(host, port) {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { servername: SMTP_HOST },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
}

async function getTransporter() {
  if (transporter) return transporter;

  const host = await resolveIPv4Host();

  for (const port of SMTP_PORTS) {
    const candidate = createTransporterForPort(host, port);
    try {
      await candidate.verify();
      console.log(`[mafia] SMTP transporter ready on port ${port}.`);
      transporter = candidate;
      return transporter;
    } catch (err) {
      console.error(`[mafia] SMTP verification failed on port ${port}:`, err.message);
      candidate.close();
    }
  }

  throw new Error(`SMTP unreachable on ports ${SMTP_PORTS.join(', ')} - the host likely blocks outbound SMTP`);
}

export async function sendRoomCreatedEmail(roomId, ownerName) {
  if (BREVO_API_KEY) {
    return sendViaBrevo(roomId, ownerName);
  }
  if (RESEND_API_KEY) {
    return sendViaResend(roomId, ownerName);
  }
  if (SENDGRID_API_KEY) {
    return sendViaSendGrid(roomId, ownerName);
  }

  console.warn('[mafia] no email API key set (BREVO_API_KEY / RESEND_API_KEY / SENDGRID_API_KEY); falling back to SMTP (may fail on Railway)');
  return sendViaSmtp(roomId, ownerName);
}

async function sendViaBrevo(roomId, ownerName) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: 'Mafia Game', email: EMAIL_FROM },
        to: [{ email: NOTIFY_EMAIL }],
        subject: `New Mafia room created: ${roomId}`,
        textContent: `A new game room was created.\n\nRoom ID: ${roomId}\nOwner: ${ownerName}`,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Brevo HTTP ${response.status}: ${errText}`);
    }
    const data = await response.json().catch(() => ({}));
    console.log(`[mafia] room-created email sent for ${roomId} via Brevo:`, data.messageId || 'ok');
  } catch (err) {
    console.error(`[mafia] failed to send room-created email for ${roomId} via Brevo:`, err.message);
  }
}

async function sendViaSmtp(roomId, ownerName) {
  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to: NOTIFY_EMAIL,
      subject: `New Mafia room created: ${roomId}`,
      text: `A new game room was created.\n\nRoom ID: ${roomId}\nOwner: ${ownerName}`,
    });
    console.log(`[mafia] room-created email sent for ${roomId}:`, info.messageId);
  } catch (err) {
    console.error(`[mafia] failed to send room-created email for ${roomId}:`, err.message);
  }
}

async function sendViaSendGrid(roomId, ownerName) {
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: NOTIFY_EMAIL }] }],
        from: { email: EMAIL_FROM },
        subject: `New Mafia room created: ${roomId}`,
        content: [{ type: 'text/plain', value: `A new game room was created.\n\nRoom ID: ${roomId}\nOwner: ${ownerName}` }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`SendGrid HTTP ${response.status}: ${errText}`);
    }
    console.log(`[mafia] room-created email sent for ${roomId} via SendGrid`);
  } catch (err) {
    console.error(`[mafia] failed to send room-created email for ${roomId} via SendGrid:`, err.message);
  }
}

async function sendViaResend(roomId, ownerName) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Mafia Game <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        subject: `New Mafia room created: ${roomId}`,
        text: `A new game room was created.\n\nRoom ID: ${roomId}\nOwner: ${ownerName}`,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Resend HTTP ${response.status}`);
    }
    const data = await response.json();
    console.log(`[mafia] room-created email sent for ${roomId} via Resend:`, data.id);
  } catch (err) {
    console.error(`[mafia] failed to send room-created email for ${roomId} via Resend:`, err.message);
  }
}
