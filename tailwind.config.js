/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff",
          500: "#0284c7",
          700: "#0369a1"
        }
      },
      boxShadow: {
        glow: "0 0 40px rgba(2,132,199,0.25)"
      }
    }
  },
  plugins: []
};
