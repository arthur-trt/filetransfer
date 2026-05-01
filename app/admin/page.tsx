import { redirect } from "next/navigation";
import styles from "./page.module.css";
import { PageFrame } from "@/components/layout/page-frame";
import { Chip } from "@/components/ui/chip";
import { formatBytes, formatRelative } from "@/lib/format";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { RevokeButton } from "./revoke-button";

export const dynamic = "force-dynamic";

const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

export default async function AdminDashboard() {
  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  if (!email || email !== adminEmail) redirect("/admin/login");

  const now = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [active, totalStorage, last7d, avgTransfer, rows] = await Promise.all([
    prisma.transfer.count({
      where: { revoked: false, completed: true, expiresAt: { gt: now } },
    }),
    prisma.transfer.aggregate({
      where: { revoked: false, completed: true },
      _sum: { totalBytes: true },
    }),
    prisma.transfer.count({
      where: { createdAt: { gt: sevenAgo }, completed: true },
    }),
    prisma.transfer.aggregate({
      where: { completed: true },
      _avg: { totalBytes: true },
    }),
    prisma.transfer.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revoked: true,
        completed: true,
        totalBytes: true,
        downloadCount: true,
        hasPassword: true,
      },
    }),
  ]);

  const totalStorageBytes = Number(totalStorage._sum.totalBytes ?? 0n);
  const avgBytes = Number(avgTransfer._avg.totalBytes ?? 0n);

  return (
    <PageFrame>
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h1 className={styles.title}>Dashboard</h1>
          <span className={styles.subtitle}>
            Metadata only · contents remain encrypted
          </span>
        </header>

        <section className={styles.stats}>
          <Stat label="Active transfers" value={active.toLocaleString()} />
          <Stat
            label="Total storage"
            value={formatBytes(totalStorageBytes).split(" ")[0]}
            unit={formatBytes(totalStorageBytes).split(" ")[1]}
          />
          <Stat label="Transfers · 7d" value={last7d.toLocaleString()} />
          <Stat
            label="Avg size"
            value={formatBytes(avgBytes).split(" ")[0]}
            unit={formatBytes(avgBytes).split(" ")[1]}
          />
        </section>

        <div className={styles.tableWrap}>
          <div className={styles.tableHeader}>
            <span className={styles.tableTitle}>Recent transfers</span>
            <span className="small">Showing {rows.length}</span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Created</th>
                <th>Size</th>
                <th>Expires</th>
                <th>Downloads</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const expired = t.expiresAt.getTime() < now.getTime();
                return (
                  <tr key={t.id}>
                    <td className={styles.id}>{t.id}</td>
                    <td className={`${styles.tnum} ${styles.muted}`}>
                      {formatRelative(t.createdAt)}
                    </td>
                    <td className={styles.tnum}>
                      {formatBytes(Number(t.totalBytes))}
                    </td>
                    <td className={`${styles.tnum} ${styles.muted}`}>
                      {expired ? "expired" : formatRelative(t.expiresAt)}
                    </td>
                    <td className={styles.tnum}>{t.downloadCount}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {t.revoked ? (
                          <Chip tone="danger">Revoked</Chip>
                        ) : !t.completed ? (
                          <Chip tone="muted">Incomplete</Chip>
                        ) : expired ? (
                          <Chip tone="muted">Expired</Chip>
                        ) : (
                          <Chip tone="accent">Active</Chip>
                        )}
                        {t.hasPassword && <Chip tone="muted">PW</Chip>}
                      </div>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {!t.revoked && !expired && t.completed && (
                          <RevokeButton id={t.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ color: "var(--ink-muted)", fontSize: 13 }}
                  >
                    No transfers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>
        {value}
        {unit && <span className={styles.statUnit}>{unit}</span>}
      </span>
    </div>
  );
}
