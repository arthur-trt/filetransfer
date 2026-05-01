import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import { TransferSentEmail } from "./templates/transfer-sent";
import { formatBytes, formatDate } from "@/lib/format";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS must be set");
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

type SendTransferArgs = {
  to: string;
  shareUrl: string;
  message?: string | null;
  fileCount: number;
  totalBytes: number;
  expiresAt: Date;
};

export async function sendTransferEmail(args: SendTransferArgs): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM not set");
  const html = await render(
    TransferSentEmail({
      shareUrl: args.shareUrl,
      message: args.message,
      fileCount: args.fileCount,
      totalBytesLabel: formatBytes(args.totalBytes),
      expiresAtLabel: formatDate(args.expiresAt),
    }),
  );
  await getTransporter().sendMail({
    from,
    to: args.to,
    subject: `You received ${args.fileCount} file${
      args.fileCount === 1 ? "" : "s"
    } — filetransfer`,
    html,
  });
}
