INSERT INTO audit_logs(id,actor_id,action,target,result,details)
SELECT 'profile-policy-007-' || user_id,NULL,'profile.avatar-policy-change',user_id,'success',
jsonb_build_object('version',pending_version,'policy','profile-updates-immediate')
FROM user_avatars WHERE status='review' AND pending_data IS NOT NULL AND pending_version IS NOT NULL;

UPDATE users u SET avatar_version=a.pending_version
FROM user_avatars a WHERE a.user_id=u.id AND a.status='review'
AND a.pending_data IS NOT NULL AND a.pending_version IS NOT NULL;

UPDATE user_avatars SET data=pending_data,updated_at=now()
WHERE status='review' AND pending_data IS NOT NULL AND pending_version IS NOT NULL;

UPDATE user_avatars SET pending_data=NULL,pending_version=NULL,status='approved',reason='';
