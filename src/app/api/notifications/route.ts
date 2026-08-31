import { NextResponse } from "next/server";
import { readWalletSession } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { notificationsForRecipient } from "@/lib/store-postgres";

export async function GET() {
  try {
    if (!isProductionMode()) return NextResponse.json({ notifications: [] });
    const session = await readWalletSession();
    if (!session) throw new Error("AUTHENTICATION_REQUIRED");
    const notifications = await notificationsForRecipient(session.address);
    return NextResponse.json({ notifications, unread: notifications.filter((item) => !item.readAt).length });
  } catch (error) { return apiError(error); }
}
