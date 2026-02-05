import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { TbInfoCircleFilled } from "react-icons/tb";

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

const CustomDNSCard = () => {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Custom DNS Configuration</CardTitle>
        <CardDescription>
          Set up and manage custom DNS settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <FieldSet>
            <FieldGroup>
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="custom-dns">Enable Custom DNS</FieldLabel>
                <Switch id="custom-dns" />
              </Field>

              <div className="grid xl:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                <Field>
                  <FieldLabel htmlFor="primary-dns">
                    Primary DNS Server
                  </FieldLabel>
                  <Input
                    id="primary-dns"
                    placeholder="Default DNS here"
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="secondary-dns">
                    Secondary DNS Server
                  </FieldLabel>
                  <Input
                    id="secondary-dns"
                    placeholder="Default secondary DNS here"
                    required
                  />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default CustomDNSCard;
