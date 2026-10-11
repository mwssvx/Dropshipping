import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BRAND } from "../src/config";
import { useSession } from "../src/session";
import { Banner, Body, Button, Card, Field } from "../src/ui";
import { color, space } from "../src/theme";

export default function Login() {
  const { signIn, finishTwoStep } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set when the account has two-step sign-in on: the next step asks for the code.
  const [twoStep, setTwoStep] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (twoStep) await finishTwoStep(twoStep, code.trim());
      else setTwoStep(await signIn(email.trim(), password));
    } catch (e) {
      // A step that ran out of time starts over from the password.
      if (twoStep && /sign in again/i.test((e as Error).message)) {
        setTwoStep(null);
        setCode("");
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: space(4) }}>
        <View style={{ gap: space(4), maxWidth: 420, width: "100%", alignSelf: "center" }}>
          <Text style={{ fontSize: 28, fontWeight: "700", color: color.ink }} role="heading" aria-level={1}>
            Sign in to {BRAND}
          </Text>
          <Body muted>Use the same email and password as on the web.</Body>
          <Card>
            {error ? <Banner tone="critical">{error}</Banner> : null}
            {twoStep ? (
              <>
                <Body>Open your authenticator app and type the 6-digit code it shows. Lost your phone? Type a recovery code instead.</Body>
                <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="none" oneTimeCode onSubmit={submit} />
                <Button label="Sign in" onPress={submit} busy={busy} disabled={!code.trim()} />
              </>
            ) : (
              <>
                <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Field label="Password" value={password} onChangeText={setPassword} secure autoCapitalize="none" onSubmit={submit} />
                <Button label="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
              </>
            )}
          </Card>
          <Body muted>New here? Create your store on the web first, then sign in.</Body>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
