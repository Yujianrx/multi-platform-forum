-- Only legacy defaults are updated. Custom identity and uploaded artwork remain unchanged.
UPDATE settings SET value=jsonb_set(value,'{name}','"多端论坛"'::jsonb)
WHERE key='site' AND value->>'name' IN (U&'\5C0F\9C7C\53F7AI\5171\521B\793E\533A','AI 共创社区');
UPDATE settings SET value=jsonb_set(value,'{description}','"分享经验与资源，让每一次讨论都有收获。"'::jsonb)
WHERE key='site' AND value->>'description'='让好想法被看见，让 AI 经验流动起来。';
