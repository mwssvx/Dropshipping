"use server";
import { revalidatePath } from "next/cache";
import { addTask, deleteTask, parseDueDate, setTaskDone, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

const fail = (e: unknown): FormState => {
  if (e instanceof UserError) return { error: e.message };
  throw e;
};

export async function addTaskAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("home");
  try {
    await addTask(db, shop.id, {
      title: String(form.get("title") ?? ""),
      note: String(form.get("note") ?? ""),
      dueAt: parseDueDate(String(form.get("due") ?? "")),
      source: "owner",
      by: user.email,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function setTaskDoneAction(id: string, done: boolean) {
  const { shop, db } = await requireShop("home");
  try {
    await setTaskDone(db, shop.id, id, done);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  revalidatePath("/admin", "layout");
}

export async function deleteTaskAction(id: string) {
  const { shop, db } = await requireShop("home");
  await deleteTask(db, shop.id, id);
  revalidatePath("/admin", "layout");
}
