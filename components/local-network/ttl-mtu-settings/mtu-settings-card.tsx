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

const MTUSettingsCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Maximum Transmission Unit (MTU) Configuration</CardTitle>
        <CardDescription>
          Manage Maximum Transmission Unit (MTU) settings for your network
          devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="mtu-setting">
                    Enable Custom MTU
                  </FieldLabel>
                  <Switch id="mtu-setting" />
                </Field>

                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="mtu-autostart-setting">
                    Enable MTU Autostart
                  </FieldLabel>
                  <Switch id="mtu-autostart-setting" />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="mtu-value">MTU Value</FieldLabel>
                <Input
                  id="mtu-value"
                  type="number"
                  placeholder="Default MTU here"
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

export default MTUSettingsCard;
