import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fundo: "#0a0e14",
        painel: "#10161e",
        painel2: "#161e28",
        borda: "#222c38",
        texto: "#e6edf3",
        suave: "#9aa6b2",
        fraco: "#66727f",
        alta: "#22c55e",
        baixa: "#f05252",
        marca: "#10b981",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
