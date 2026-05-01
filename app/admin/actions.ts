"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deletePrefix } from "@/lib/r2";

const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

export async function revokeTransfer(id: string): Promise<void> {
  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  if (!email || email !== adminEmail) throw new Error("unauthorized");
  if (!/^[A-Z2-9]{10}$/.test(id)) throw new Error("invalid id");

  await deletePrefix(`transfers/${id}/`);
  await prisma.transfer.update({
    where: { id },
    data: {
      revoked: true,
      completed: true,
      multipartIds: Prisma.JsonNull,
    },
  });
  revalidatePath("/admin");
}
