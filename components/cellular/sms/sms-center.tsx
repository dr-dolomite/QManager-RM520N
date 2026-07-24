"use client";

import { useTranslation } from "react-i18next";
import SmsInboxCard from "./sms-inbox-card";
import { useSms } from "@/hooks/use-sms";

const SmsCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSaving,
    error,
    sendSms,
    deleteSms,
    deleteAllSms,
    refresh,
  } = useSms();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{t("sms.page.title")}</h1>
        <p className="text-muted-foreground">
          {t("sms.page.description")}
        </p>
      </div>
      <div className="grid grid-cols-1 grid-flow-row gap-4">
        <SmsInboxCard
          data={data}
          isLoading={isLoading}
          isSaving={isSaving}
          error={error}
          onSend={sendSms}
          onDelete={deleteSms}
          onDeleteAll={deleteAllSms}
          onRefresh={() => refresh()}
        />
      </div>
    </div>
  );
};

export default SmsCenterComponent;
