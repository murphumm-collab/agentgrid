import { NextResponse } from "next/server";
import { requireWalletSession } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { notificationsForRecipient } from "@/lib/store-postgres";
import { notificationsResponseSchema } from "@/lib/wallet-workflow-schema";
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function GET() {
  try {
    const session = await requireWalletSession();
    if (!isProductionMode()) return NextResponse.json(notificationsResponseSchema.parse({ notifications: [], unread: 0 }), { headers: privateHeaders });
    const notifications = await notificationsForRecipient(session.address);
    return NextResponse.json(notificationsResponseSchema.parse({
      notifications,
      unread: notifications.filter((item) => !item.readAt).length,
    }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
