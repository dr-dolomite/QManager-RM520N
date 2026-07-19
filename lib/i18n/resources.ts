import enCommon from "@/public/locales/en/common.json";
import enSidebar from "@/public/locales/en/sidebar.json";
import enDashboard from "@/public/locales/en/dashboard.json";
import zhCNCommon from "@/public/locales/zh-CN/common.json";
import zhCNSidebar from "@/public/locales/zh-CN/sidebar.json";
import zhCNDashboard from "@/public/locales/zh-CN/dashboard.json";
import zhTWCommon from "@/public/locales/zh-TW/common.json";
import zhTWSidebar from "@/public/locales/zh-TW/sidebar.json";
import zhTWDashboard from "@/public/locales/zh-TW/dashboard.json";
import itCommon from "@/public/locales/it/common.json";
import itSidebar from "@/public/locales/it/sidebar.json";
import itDashboard from "@/public/locales/it/dashboard.json";
import idCommon from "@/public/locales/id/common.json";
import idSidebar from "@/public/locales/id/sidebar.json";
import idDashboard from "@/public/locales/id/dashboard.json";

// Static resources for i18next. Every bundled language declares every namespace.
// Bundle-only: the whole locale catalog rides the existing out/ → www deploy
// path, so nothing is fetched at runtime.
export const resources = {
  en: {
    common: enCommon,
    sidebar: enSidebar,
    dashboard: enDashboard,
  },
  "zh-CN": {
    common: zhCNCommon,
    sidebar: zhCNSidebar,
    dashboard: zhCNDashboard,
  },
  "zh-TW": {
    common: zhTWCommon,
    sidebar: zhTWSidebar,
    dashboard: zhTWDashboard,
  },
  it: {
    common: itCommon,
    sidebar: itSidebar,
    dashboard: itDashboard,
  },
  id: {
    common: idCommon,
    sidebar: idSidebar,
    dashboard: idDashboard,
  },
} as const;

export const DEFAULT_NAMESPACE = "common" as const;
export const ALL_NAMESPACES = ["common", "sidebar", "dashboard"] as const;
