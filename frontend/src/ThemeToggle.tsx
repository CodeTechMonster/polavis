import { useThemeStore } from "./store";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <button
      onClick={toggleTheme}
      className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--surface)]"
    >
      {theme === "dark" ? "☀ Day mode" : "🌙 Dark mode"}
    </button>
  );
}
