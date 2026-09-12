import { useEffect, type ReactNode } from "react";
import { useThemeStore } from "./store";

export default function ThemeSync({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  return <>{children}</>;
}
