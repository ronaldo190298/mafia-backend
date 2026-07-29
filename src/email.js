import nodemailer from 'nodemailer';

const NOTIFY_EMAIL = 'lampardronalo1@gmail.com';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USER = 'lampardronaldo1@gmail.com';
const SMTP_PASS = 'obcn jdxs luab hszk';
const SMTP_FROM = 'lampardronaldo1@gmail.com>';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export function sendRoomCreatedEmail(roomId, ownerName) {
  const t = getTransporter();
  t.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to: NOTIFY_EMAIL,
    subject: `New Mafia room created: ${roomId}`,
    text: `A new game room was created.\n\nRoom ID: ${roomId}\nOwner: ${ownerName}`,
  }).catch((err) => {
    console.error(`[mafia] failed to send room-created email for ${roomId}:`, err.message);
  });
}
