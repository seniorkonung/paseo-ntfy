import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerNtfyPills } from "./client/pill";
import { NtfySettingsScreen } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "ntfy",
    title: "Ntfy notifications",
    icon: "Bell",
    Component: NtfySettingsScreen,
  });
  const removePills = registerNtfyPills(client);
  return () => {
    removePills();
    removeSettings();
  };
}
