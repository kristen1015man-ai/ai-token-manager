import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Download, Laptop, MonitorDown, ShieldCheck, Sparkles, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import styles from "./download.module.css";

export const dynamic = "force-dynamic";

// 桌面安装包发布清单（Electron 产物）。
// 发新版时只改这里即可：version + 三平台直链 + 各自 sha256（可选，留空字符串则不显示）。
// 直链走 GitHub Releases；中国大陆可通过 gh-proxy.com 镜像加速。
const DESKTOP_RELEASE = {
  version: "0.2.0",
  github: "https://github.com/kristen1015man-ai/ai-token-manager/releases/tag/v0.2.0",
  platforms: {
    windows: {
      label: "Windows",
      arch: "x64",
      ext: ".exe",
      url: "https://github.com/kristen1015man-ai/ai-token-manager/releases/download/v0.2.0/Sparkloom.Studio.Setup.0.2.0.exe",
      sha256: "",
      // 安装方式：Electron 双击安装
      install: "双击 .exe 安装包，按向导完成安装后从开始菜单启动 Sparkloom Studio。",
      note: "适用于 Windows 10/11 (x64)。安装后会自动接入本机 Studio，无需再配 Node/Python 环境。",
    },
    macArm64: {
      label: "macOS",
      arch: "Apple Silicon (M1/M2/M3/M4)",
      ext: ".dmg",
      url: "https://github.com/kristen1015man-ai/ai-token-manager/releases/download/v0.2.0/Sparkloom.Studio-0.2.0-arm64.dmg",
      sha256: "",
      install: "双击 .dmg，把 Sparkloom Studio 拖入 Applications。首次打开右键 → 打开（M 芯片 Gatekeeper 验证）。",
      note: "适用于 macOS Apple Silicon（M 系列芯片）。安装后从启动台打开即可。",
    },
    macIntel: {
      label: "macOS",
      arch: "Intel (x64)",
      ext: ".dmg",
      url: "https://github.com/kristen1015man-ai/ai-token-manager/releases/download/v0.2.0/Sparkloom.Studio-0.2.0.dmg",
      sha256: "",
      install: "双击 .dmg，把 Sparkloom Studio 拖入 Applications，从启动台打开。",
      note: "适用于 macOS Intel 芯片。如果不确定芯片类型，点苹果菜单 →「关于本机」查看。",
    },
  },
} as const;

// 中国大陆加速镜像前缀（直链前面拼接即可走代理下载，不改原链接）
const CN_MIRROR_PREFIX = "https://gh-proxy.com/";

type PlatformKey = keyof typeof DESKTOP_RELEASE.platforms;

function mirrorUrl(directUrl: string): string {
  return `${CN_MIRROR_PREFIX}${directUrl}`;
}

export default function DownloadPage() {
  const version = DESKTOP_RELEASE.version;

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
            <span className={styles.badge}>Sparkloom · v{version}</span>
            <h1>
              <span>下载 Sparkloom 桌面端</span>
              <span>安装后自动连接 Studio</span>
            </h1>
            <p>
              桌面端是 Electron 一键安装包，自带运行所需全部环境。Windows 双击 .exe、macOS 拖入 Applications 即可，无需手动安装 Node.js / Python / Git。
            </p>
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

        <section className={styles.cards} aria-label="下载 Sparkloom 桌面端">
          <DownloadCard platformKey="windows" />
          <DownloadCard platformKey="macArm64" />
          <DownloadCard platformKey="macIntel" />
        </section>

        <section className={styles.steps}>
          <Step icon={Download} title="下载安装包" text="根据系统选择对应安装包。Windows 是 .exe，macOS 是 .dmg。" />
          <Step icon={MonitorDown} title="双击安装" text="Windows 双击 .exe；macOS 双击 .dmg 后把应用拖入 Applications。" />
          <Step icon={CheckCircle2} title="看到已连接" text="打开 Sparkloom Studio，浏览器中的 Studio 会自动检测到本机连接。" />
          <Step icon={ShieldCheck} title="安全保护" text="不会保存供应商官方密钥；本机敏感操作需要来自桌面入口的连接确认。" />
        </section>

        <section className={styles.releaseNote}>
          <TerminalSquare size={16} />
          <span>
            全部发布产物见 GitHub Releases：
            <a href={DESKTOP_RELEASE.github} target="_blank" rel="noreferrer">v{version} release notes</a>。
            中国大陆如直连下载慢，请使用卡片下方的「镜像下载（中国大陆加速）」。
          </span>
        </section>
      </section>
    </main>
  );
}

function DownloadCard({ platformKey }: { platformKey: PlatformKey }) {
  const p = DESKTOP_RELEASE.platforms[platformKey];
  const enabled = Boolean(p.url);
  const title = platformKey === "windows" ? `${p.label} ${p.arch}` : `${p.label} ${p.arch}`;

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <MonitorDown size={22} />
        <div>
          <h2>{title}</h2>
          <p>{p.note}</p>
        </div>
      </div>
      {enabled ? (
        <div className={styles.downloadButtons}>
          <a className={styles.downloadButton} href={p.url}>
            <Download size={17} />
            下载 {p.label} {p.ext}
          </a>
          <a
            className={`${styles.downloadButton} ${styles.downloadButtonMirror}`}
            href={mirrorUrl(p.url)}
            title={`经 gh-proxy.com 代理下载（中国大陆加速）：${CN_MIRROR_PREFIX}${p.url}`}
          >
            <Download size={15} />
            镜像下载（中国大陆加速）
          </a>
        </div>
      ) : (
        <button className={styles.disabledButton} type="button" disabled>
          安装包待发布
        </button>
      )}
      <div className={styles.commandLine}>
        <code>{p.install}</code>
      </div>
      <code className={styles.hash}>{p.sha256 || `SHA256 发布后于 GitHub Releases 查看（v${DESKTOP_RELEASE.version}）`}</code>
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
