import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { TbInfoCircleFilled } from "react-icons/tb";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

const TTLSettingsCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Time To Live (TTL) Configuration</CardTitle>
        <CardDescription>
          Manage Time To Live (TTL) settings for your network devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="ttl-setting">
                    Enable Custom TTL
                  </FieldLabel>
                  <Switch id="ttl-setting" />
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="ttl-setting">
                    Enable TTL Autostart
                  </FieldLabel>
                  <Switch id="ttl-setting" />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="ttl-value">TTL Value</FieldLabel>
                <Input
                  id="ttl-value"
                  type="number"
                  placeholder="Default TTL here"
                  className="max-w-sm"
                  required
                />
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default TTLSettingsCard;
