import nodemailer from "nodemailer";

import { getOutboundEmailConfig, type OutboundEmailConfig } from "@/lib/email/outbound/config";
import type { OutboundEmailMessage, OutboundEmailSendResult, OutboundEmailTransport } from "@/lib/email/outbound/types";

export function createSmtpOutboundEmailTransport(
  config: OutboundEmailConfig = getOutboundEmailConfig(),
): OutboundEmailTransport {
  const transport =
    config.emailTransport === "local-sink"
      ? nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: false,
          ignoreTLS: true,
        })
      : nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          requireTLS: config.smtpRequireTls,
          ignoreTLS: false,
          auth: {
            user: config.smtpUser!,
            pass: config.smtpPassword!,
          },
        });

  return {
    async send(message: OutboundEmailMessage): Promise<OutboundEmailSendResult> {
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? undefined,
      });

      return {
        providerMessageId: info.messageId ?? null,
      };
    },
  };
}
