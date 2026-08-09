import { JarvisShell } from "@/ui/JarvisShell";
import { SafeJarvisShell } from "@/ui/SafeJarvisShell";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export default function Home() {
  return isSafeAgentCoreEnabled() ? <SafeJarvisShell /> : <JarvisShell />;
}
