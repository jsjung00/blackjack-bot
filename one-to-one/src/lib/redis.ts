import { createClient } from "@redis/client";
import { RedisClientType } from "@redis/client";

export const getRedisClient = async () => {
  const client = createClient({
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: "redis-17497.c1.us-central1-2.gce.redns.redis-cloud.com",
      port: 17497,
    },
  });

  client.on("error", (err) => {
    console.error("Redis client error:", err);
  });

  await client.connect();
  return client as RedisClientType;
};
