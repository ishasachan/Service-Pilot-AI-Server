import dotenv from "dotenv";

import { supabase } from "../src/config/db";

dotenv.config();

async function syncAuthUsers() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, name, role, password_hash, auth_user_id");

  if (error) {
    throw new Error(error.message);
  }

  for (const user of users ?? []) {
    if (user.auth_user_id) {
      console.log(`Skipping ${user.email} — already linked`);
      continue;
    }

    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email: user.email,
        password_hash: user.password_hash,
        email_confirm: true,
        user_metadata: {
          name: user.name,
          role: user.role,
        },
      });

    if (createError) {
      console.error(`Failed to create auth user for ${user.email}:`, createError.message);
      continue;
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ auth_user_id: created.user.id })
      .eq("id", user.id);

    if (updateError) {
      console.error(`Failed to link ${user.email}:`, updateError.message);
      continue;
    }

    console.log(`Linked ${user.email} → ${created.user.id}`);
  }
}

syncAuthUsers()
  .then(() => {
    console.log("Auth user sync complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
