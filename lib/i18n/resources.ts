import enCommon from "@/public/locales/en/common.json";
import enSidebar from "@/public/locales/en/sidebar.json";
import enDashboard from "@/public/locales/en/dashboard.json";
import enCellular from "@/public/locales/en/cellular.json";
import enSystemSettings from "@/public/locales/en/system-settings.json";
import zhCNCommon from "@/public/locales/zh-CN/common.json";
import zhCNSidebar from "@/public/locales/zh-CN/sidebar.json";
import zhCNDashboard from "@/public/locales/zh-CN/dashboard.json";
import zhCNCellular from "@/public/locales/zh-CN/cellular.json";
import zhCNSystemSettings from "@/public/locales/zh-CN/system-settings.json";
import zhTWCommon from "@/public/locales/zh-TW/common.json";
import zhTWSidebar from "@/public/locales/zh-TW/sidebar.json";
import zhTWDashboard from "@/public/locales/zh-TW/dashboard.json";
import zhTWCellular from "@/public/locales/zh-TW/cellular.json";
import zhTWSystemSettings from "@/public/locales/zh-TW/system-settings.json";
import itCommon from "@/public/locales/it/common.json";
import itSidebar from "@/public/locales/it/sidebar.json";
import itDashboard from "@/public/locales/it/dashboard.json";
import itCellular from "@/public/locales/it/cellular.json";
import itSystemSettings from "@/public/locales/it/system-settings.json";
import idCommon from "@/public/locales/id/common.json";
import idSidebar from "@/public/locales/id/sidebar.json";
import idDashboard from "@/public/locales/id/dashboard.json";
import idCellular from "@/public/locales/id/cellular.json";
import idSystemSettings from "@/public/locales/id/system-settings.json";

// Static resources for i18next. Every bundled language declares every namespace.
// Bundle-only: the whole locale catalog rides the existing out/ → www deploy
// path, so nothing is fetched at runtime.
export const resources = {
  en: {
    common: enCommon,
    sidebar: enSidebar,
    dashboard: enDashboard,
    cellular: enCellular,
    "system-settings": enSystemSettings,
  },
  "zh-CN": {
    common: zhCNCommon,
    sidebar: zhCNSidebar,
    dashboard: zhCNDashboard,
    cellular: zhCNCellular,
    "system-settings": zhCNSystemSettings,
  },
  "zh-TW": {
    common: zhTWCommon,
    sidebar: zhTWSidebar,
    dashboard: zhTWDashboard,
    cellular: zhTWCellular,
    "system-settings": zhTWSystemSettings,
  },
  it: {
    common: itCommon,
    sidebar: itSidebar,
    dashboard: itDashboard,
    cellular: itCellular,
    "system-settings": itSystemSettings,
  },
  id: {
    common: idCommon,
    sidebar: idSidebar,
    dashboard: idDashboard,
    cellular: idCellular,
    "system-settings": idSystemSettings,
  },
} as const;

export const DEFAULT_NAMESPACE = "common" as const;
export const ALL_NAMESPACES = ["common", "sidebar", "dashboard", "cellular", "system-settings"] as const;
