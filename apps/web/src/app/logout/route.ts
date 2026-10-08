import { signOutAction } from "../(auth)/actions";

export async function POST() {
  await signOutAction();
}
