import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Link,
  Hr,
} from "@react-email/components";

type Props = {
  shareUrl: string;
  message?: string | null;
  fileCount: number;
  totalBytesLabel: string;
  expiresAtLabel: string;
};

const bone = "#F5F2EC";
const ink = "#141414";
const muted = "#5C5A55";
const accent = "#1F6F43";

export function TransferSentEmail({
  shareUrl,
  message,
  fileCount,
  totalBytesLabel,
  expiresAtLabel,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>Someone sent you {fileCount} file(s) via filetransfer</Preview>
      <Body
        style={{
          backgroundColor: bone,
          color: ink,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif",
          margin: 0,
          padding: "32px 16px",
        }}
      >
        <Container
          style={{
            maxWidth: 520,
            margin: "0 auto",
            padding: "32px",
            backgroundColor: bone,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: muted,
              margin: 0,
            }}
          >
            filetransfer
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: "-0.015em",
              margin: "16px 0 8px",
            }}
          >
            Someone sent you <span style={{ color: accent }}>{fileCount} file{fileCount === 1 ? "" : "s"}</span>.
          </Text>
          <Text style={{ fontSize: 14, color: muted, margin: "0 0 24px" }}>
            {totalBytesLabel} · expires {expiresAtLabel}
          </Text>
          {message ? (
            <Section
              style={{
                borderLeft: `2px solid ${muted}`,
                paddingLeft: 12,
                margin: "0 0 24px",
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                  color: ink,
                }}
              >
                {message}
              </Text>
            </Section>
          ) : null}
          <Section style={{ margin: "24px 0" }}>
            <Link
              href={shareUrl}
              style={{
                backgroundColor: accent,
                color: bone,
                padding: "12px 24px",
                borderRadius: 2,
                textDecoration: "none",
                fontSize: 15,
                fontWeight: 500,
                display: "inline-block",
              }}
            >
              Decrypt & download →
            </Link>
          </Section>
          <Hr style={{ borderColor: "rgba(20,20,20,0.1)", margin: "24px 0" }} />
          <Text style={{ fontSize: 12, color: muted, margin: 0 }}>
            End-to-end encrypted. The decryption key lives in the link, not on
            our servers. If the URL above looks incomplete, re-copy it from the
            original message.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
