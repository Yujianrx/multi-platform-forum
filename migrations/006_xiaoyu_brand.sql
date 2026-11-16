UPDATE settings SET value=jsonb_set(value,'{name}','"小鱼号AI共创社区"'::jsonb) WHERE key='site';
