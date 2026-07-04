"use client";

import { useState } from "react";
import { CheckCircle2, Download, Loader2, Sparkles, WandSparkles } from "lucide-react";
import styles from "./studio.module.css";

interface Props {
  // 已安装/未安装的 skill key 列表（来自 agent /skills/status）
  installed: string[];
  missing: string[];
  // 触发：发送 prompt 给 composer
  onUseSkill: (prompt: string) => void;
  // 安装调用：调 agent /skills/install
  onInstall: () => Promise<void>;
  // 错误回调：把失败信息走父组件 setError 通道，避免吞掉
  onError?: (message: string) => void;
}

// BUILT_IN_SKILLS：name(中文标签) + key(skill 标识)
const SKILLS_CATALOG: Array<{ key: string; name: string; hint: string; trigger: string }> = [
  { key: "sparkloom-project-doctor", name: "项目启动检测", hint: "检查项目能否干净启动，识别缺失运行时依赖", trigger: "帮我检查项目能否正常启动，列出缺失的运行时依赖和修复步骤。" },
  { key: "sparkloom-code-review", name: "代码审查", hint: "对照 Spec 审查代码质量、bug、回归、安全", trigger: "请对当前改动做一次代码审查，重点关注 bug、回归、缺失测试和安全风险。" },
  { key: "sparkloom-bug-fix", name: "Bug 修复", hint: "用最小可验证改动定位并修复 bug", trigger: "请帮我定位并修复当前的 bug，使用最小可验证的改动。" },
  { key: "sparkloom-frontend-ux-review", name: "前端 UI 审查", hint: "审查布局、交互、响应式、可访问性", trigger: "请审查前端页面的布局、交互、响应式和可访问性问题。" },
  { key: "sparkloom-nextjs-check", name: "Next.js 项目检查", hint: "检查路由、运行时、数据获取、构建问题", trigger: "请检查这个 Next.js 项目的路由、运行时、数据获取和构建相关问题。" },
  { key: "sparkloom-dependency-repair", name: "依赖安装排查", hint: "诊断包管理器、lockfile、运行时依赖问题", trigger: "请帮我诊断并修复依赖安装问题（包管理器、lockfile、运行时依赖）。" },
  { key: "sparkloom-release-check", name: "生产发布检查", hint: "上线前 web/proxy/db/desktop 发布就绪审查", trigger: "请对当前改动做一次生产发布前的就绪审查（web/proxy/db/desktop）。" },
  { key: "sparkloom-git-summary", name: "Git 提交说明", hint: "从改动生成清晰的 commit message 和 release notes", trigger: "请根据当前本地改动生成清晰的 git commit 摘要和 release notes。" },
];

// P0-4 Skills tab：展示已安装/未安装 + 一键安装 + 用这个 skill 快捷发送
export default function SkillsPanel({ installed, missing, onUseSkill, onInstall, onError }: Props) {
  const [installing, setInstalling] = useState(false);
  const [installedLocal, setInstalledLocal] = useState<Set<string>>(new Set());

  // 防御：父组件理论上始终传数组，但 /skills/status 返回畸形数据（installed/missing 字段缺失）时
  // 也可能传入 undefined/null。这里兜底成空数组，避免 .includes 抛错导致整个 tab 崩溃。
  const installedList = installed ?? [];
  const missingList = missing ?? [];
  const agentOffline = installedList.length === 0 && missingList.length === 0;

  const isInstalled = (key: string) => installedList.includes(key) || installedLocal.has(key);

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    // 快照本次要装的目标：onInstall 不抛即视为命令链成功；服务端真实状态由父组件 checkAgent 刷新后传入 installed 覆盖。
    // 不再无脑 setInstalledLocal(new Set([...missing]))——那样部分失败也会被误标全部完成。
    const targetKeys = missingList.slice();
    try {
      await onInstall();
      setInstalledLocal((prev) => {
        const next = new Set(prev);
        targetKeys.forEach((k) => next.add(k));
        return next;
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "技能安装失败");
    } finally {
      setInstalling(false);
    }
  };

  const allInstalledOptimistic = missingList.length > 0 && missingList.every((k) => installedLocal.has(k));
  const hasMissing = missingList.length > 0 && !allInstalledOptimistic;

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <Sparkles size={17} />
          <span>内置技能</span>
        </h3>
        {hasMissing && (
          <button
            type="button"
            className={styles.skillsInstallAll}
            onClick={handleInstall}
            disabled={installing}
            title="把所有内置 skill 复制到本机 Claude Code 配置目录"
          >
            {installing ? <Loader2 size={12} className={styles.spin} /> : <Download size={12} />}
            {installing ? "安装中" : "一键全部安装"}
          </button>
        )}
      </div>
      <p className={styles.skillsHint}>
        技能是一组预制 Skill 提示，对应一类高频任务。点击「用这个 skill」会把触发语发送到对话，由 Claude 自动展开执行。
      </p>
      {agentOffline && (
        <p className={styles.skillsHint} style={{ color: "#fbbf24" }}>
          本机 Agent 未连接，暂时无法读取安装状态。先在主界面连接 Agent 后再回来查看。
        </p>
      )}
      <ul className={styles.skillsList}>
        {SKILLS_CATALOG.map((s) => {
          const ok = isInstalled(s.key);
          return (
            <li key={s.key} className={`${styles.skillItem} ${ok ? styles.skillInstalled : ""}`}>
              <div className={styles.skillMeta}>
                <strong>{s.name}</strong>
                <em>{s.hint}</em>
                <span className={styles.skillKey}>{s.key}</span>
              </div>
              <div className={styles.skillActions}>
                {ok ? (
                  <span className={styles.skillBadge}><CheckCircle2 size={11} /> 已安装</span>
                ) : (
                  <button
                    type="button"
                    className={styles.skillInstallBtn}
                    onClick={handleInstall}
                    disabled={installing}
                    title="复制到本机 Claude Code 配置目录"
                  >
                    {installing ? <Loader2 size={11} className={styles.spin} /> : <Download size={11} />}
                    安装
                  </button>
                )}
                <button
                  type="button"
                  className={styles.skillUseBtn}
                  onClick={() => onUseSkill(s.trigger)}
                  title={`发送：「${s.trigger.slice(0, 30)}…」`}
                >
                  <WandSparkles size={11} />
                  用这个 skill
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
