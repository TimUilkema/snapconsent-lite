import { HttpError } from "@/lib/http/errors";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatOutboundEmailTimestampUtc(inputIso: string) {
  const date = new Date(inputIso);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(500, "outbound_email_invalid_timestamp", "Outbound email timestamp is invalid.");
  }

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
