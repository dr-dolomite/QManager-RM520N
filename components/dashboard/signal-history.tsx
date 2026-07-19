"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSignalHistory } from "@/hooks/use-signal-history";
import type { SignalChartPoint } from "@/hooks/use-signal-history";

export const description = "Signal history chart for RSRP, RSRQ, and SINR";

const chartConfig = {
  rsrp4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  rsrp5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
  rsrq4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  rsrq5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
  sinr4G: {
    label: "LTE",
    color: "var(--chart-1)",
  },
  sinr5G: {
    label: "5G",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function SignalHistoryComponent() {
  const { t } = useTranslation("dashboard");
  const gradientId = useId();
  const [signalType, setSignalType] = useState("rsrp");
  const { chartData, isLoading } = useSignalHistory();
  const id4G = `${gradientId}-fill4G`;
  const id5G = `${gradientId}-fill5G`;

  const getDataKeys = () => {
    switch (signalType) {
      case "rsrp":
        return { key4G: "rsrp4G", key5G: "rsrp5G", unit: "dBm", label: "RSRP" };
      case "rsrq":
        return { key4G: "rsrq4G", key5G: "rsrq5G", unit: "dB", label: "RSRQ" };
      case "sinr":
        return { key4G: "sinr4G", key5G: "sinr5G", unit: "dB", label: "SINR" };
      default:
        return { key4G: "rsrp4G", key5G: "rsrp5G", unit: "dBm", label: "RSRP" };
    }
  };

  const { key4G, key5G } = getDataKeys();

  // Calculate the min value for the current signal type to use as baseline
  const getBaseValue = () => {
    if (chartData.length === 0) return 0;
    const values = chartData
      .flatMap((d) => [
        d[key4G as keyof SignalChartPoint] as number | null,
        d[key5G as keyof SignalChartPoint] as number | null,
      ])
      .filter((v): v is number => v !== null);
    if (values.length === 0) return 0;
    return Math.min(...values);
  };

  const baseValue = getBaseValue();

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl">
          {t("signal_history.title")}
        </CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            value={signalType}
            onValueChange={(value) => value && setSignalType(value)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[540px]/card:flex"
          >
            <ToggleGroupItem value="rsrp">RSRP</ToggleGroupItem>
            <ToggleGroupItem value="rsrq">RSRQ</ToggleGroupItem>
            <ToggleGroupItem value="sinr">SINR</ToggleGroupItem>
          </ToggleGroup>
          <Select value={signalType} onValueChange={setSignalType}>
            <SelectTrigger
              className="flex w-32 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[540px]/card:hidden"
              size="sm"
              aria-label={t("signal_history.select_aria")}
            >
              <SelectValue placeholder="RSRP" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="rsrp" className="rounded-lg">
                RSRP
              </SelectItem>
              <SelectItem value="rsrq" className="rounded-lg">
                RSRQ
              </SelectItem>
              <SelectItem value="sinr" className="rounded-lg">
                SINR
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {isLoading ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            {t("signal_history.loading_message")}
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            {t("signal_history.no_data_message")}
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={id4G} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${key4G})`}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${key4G})`}
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id={id5G} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${key5G})`}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${key5G})`}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `${value}`}
                domain={["dataMin - 5", "dataMax + 5"]}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => `${value}`}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey={key4G}
                type="monotone"
                fill={`url(#${id4G})`}
                stroke={`var(--color-${key4G})`}
                baseValue={baseValue}
                connectNulls={false}
              />
              <Area
                dataKey={key5G}
                type="monotone"
                fill={`url(#${id5G})`}
                stroke={`var(--color-${key5G})`}
                baseValue={baseValue}
                connectNulls={false}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter>
        <div className="flex w-full items-start gap-2 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 leading-none font-medium">
              {t("signal_history.chart_description", {
                signal_type: signalType.toUpperCase(),
              })}
            </div>
            <div className="text-muted-foreground flex items-center gap-2 leading-none">
              {t("signal_history.fluctuation_note")}
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
