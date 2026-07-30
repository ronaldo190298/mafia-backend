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
const EMAIL_API_KEY = process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY || '';
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'sendgrid'; // 'sendgrid' | 'resend'
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_FROM;

let transporter = null;
let transporterHost = null;

async function getTransporter() {
  if (transporter) return transporter;

  let host = SMTP_HOST;
  try {
    const addresses = await resolve4(SMTP_HOST);
    if (addresses.length) {
      host = addresses[0];
      transporterHost = host;
      console.log(`[mafia] resolved ${SMTP_HOST} to IPv4 ${host}`);
    }
  } catch (err) {
    console.warn(`[mafia] could not resolve IPv4 for ${SMTP_HOST}:`, err.message);
  }

  transporter = nodemailer.createTransport({
    host,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { servername: SMTP_HOST },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  transporter.verify((err) => {
    if (err) {
      console.error('[mafia] SMTP transporter verification failed:', err.message);
    } else {
      console.log('[mafia] SMTP transporter ready.');
    }
  });

  return transporter;
}

export async function sendRoomCreatedEmail(roomId, ownerName) {
  if (EMAIL_API_KEY) {
    if (EMAIL_PROVIDER === 'resend') {
      return sendViaResend(roomId, ownerName);
    }
    return sendViaSendGrid(roomId, ownerName);
  }

  console.warn('[mafia] EMAIL_API_KEY not set; falling back to SMTP (may fail on Railway)');
  return sendViaSmtp(roomId, ownerName);
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
        Authorization: `Bearer ${EMAIL_API_KEY}`,
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
        Authorization: `Bearer ${EMAIL_API_KEY}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
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
