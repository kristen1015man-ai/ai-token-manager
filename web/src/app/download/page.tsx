import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Copy, Download, Laptop, MonitorDown, ShieldCheck, Sparkles, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { STUDIO_AGENT_RELEASE } from "@/generated/studio-agent-release";
import styles from "./download.module.css";

export const dynamic = "force-dynamic";

function getArtifact(platform: "windows" | "mac") {
  const manifestPlatform = platform === "windows" ? "windows" : "macos";
  const bundled = STUDIO_AGENT_RELEASE.artifacts.find((artifact) => artifact.platform === manifestPlatform);

  return {
    url: bundled?.publicPath || "",
    sha256: bundled?.sha256 || "",
    label: platform === "windows" ? "Windows" : "macOS",
    command: platform === "windows" ? "双击 Start Sparkloom.cmd" : "chmod +x ./install-macos.sh && ./install-macos.sh",
    note: platform === "windows"
      ? "适用于 Windows 10/11。解压后只需要双击一个文件，后续会自动安装、启动并打开 Studio。"
      : "适用于 macOS Apple Silicon / Intel。解压后用 Terminal 运行安装脚本，自动检查 Homebrew、Node.js、Python、Git 和 Sparkloom Agent SDK。",
  };
}

export default function DownloadPage() {
  const version = STUDIO_AGENT_RELEASE.version || "preview";
  const windows = getArtifact("windows");
  const mac = getArtifact("mac");

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.topbar}>
          <Link href="/dashboard" className={styles.brand}>
            <Image src="/logo.png" alt={BRAND_NAME} width={36} height={36} />
            <span>{BRAND_NAME}</span>
          </Link>
          <nav className={styles.nav}>
            <Link href="/studio">
              <Sparkles size={16} />
              Open Studio
            </Link>
          </nav>
        </header>

        <section className={styles.hero}>
          <div>
            <span className={styles.badge}>Sparkloom · {version}</span>
            <h1>
              <span>下载 Sparkloom</span>
              <span>打开后自动连接 Studio</span>
            </h1>
            <p>Windows 用户先“全部解压”，再双击 Start Sparkloom。安装、启动、打开 Studio 会自动完成。</p>
          </div>
          <div className={styles.devicePreview} aria-hidden="true">
            <div className={styles.deviceChrome}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.deviceBody}>
              <Laptop size={42} />
              <strong>Sparkloom Studio</strong>
              <em>127.0.0.1:39271</em>
            </div>
          </div>
        </section>

        <section className={styles.cards} aria-label="下载 Sparkloom">
          <DownloadCard artifact={windows} />
          <DownloadCard artifact={mac} />
        </section>

        <section className={styles.steps}>
          <Step icon={Download} title="下载 Sparkloom" text="选择对应系统。Windows 下载后先右键 zip，选择“全部解压”。" />
          <Step icon={TerminalSquare} title="双击开始使用" text="Windows 双击 Start Sparkloom.cmd；安装、启动、打开 Studio 会自动完成。" />
          <Step icon={CheckCircle2} title="看到已连接" text="Studio 会自动检测本机连接。看到已连接后即可开始使用。" />
          <Step icon={ShieldCheck} title="安全保护" text="不会保存供应商官方密钥；本机敏感操作需要来自桌面入口的连接确认。" />
        </section>
      </section>
    </main>
  );
}

function DownloadCard({
  artifact,
}: {
  artifact: { url: string; sha256: string; label: string; command: string; note: string };
}) {
  const enabled = Boolean(artifact.url);

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <MonitorDown size={22} />
        <div>
          <h2>{artifact.label}</h2>
          <p>{artifact.note}</p>
        </div>
      </div>
      {enabled ? (
        <a className={styles.downloadButton} href={artifact.url}>
          <Download size={17} />
          下载 {artifact.label} Sparkloom
        </a>
      ) : (
        <button className={styles.disabledButton} type="button" disabled>
          安装包待发布
        </button>
      )}
      <div className={styles.commandLine}>
        <code>{artifact.command}</code>
        <Copy size={14} />
      </div>
      <code className={styles.hash}>{artifact.sha256 || "SHA256 发布后显示"}</code>
    </article>
  );
}

function Step({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className={styles.step}>
      <Icon size={20} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
