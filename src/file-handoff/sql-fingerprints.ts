// Proposed0022/0023 and original native owner-session function bodies; requalify SQL/ACLs after changes.
export const fileSqlFingerprints={
  "file_handoff_permissions_version": {
    "digest": "23f62a8892370d49ff56700b77a7568f29ad064e773aec8d92b0ad58ec618a36",
    "definer": false,
    "grantees": [
      "lifeos_agent_key_manager",
      "lifeos_agent_verifier",
      "lifeos_platform_candidate_runtime"
    ]
  },
  "file_handoff_identity_ready": {
    "digest": "5b1e2bae201cca9750f91cbb2fbbce3325cdccab1a7a4e06a10622473321efc2",
    "definer": true,
    "grantees": []
  },
  "read_file_handoff_permission": {
    "digest": "f3fd02ae9ae55c609923e5872f04ee6acee0172d14716ad629422c991b85a0af",
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager",
      "lifeos_agent_verifier",
      "lifeos_platform_candidate_runtime"
    ]
  },
  "assert_file_handoff_permission": {
    "digest": "8b1aa1723e2466672c9472ce2c12ae5d5c8eaae027b90da5a27b69e4d9516606",
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ]
  },
  "set_file_handoff_permission": {
    "digest": "67bd0fa43cd20b09370f6444ff2aaddca8032300d33ccb1f76d94dcc15f82725",
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager"
    ]
  },
  "assert_file_handoff_owner": {
    "digest": "ea348af5aba3e21f4f62b040c2b3f78c2bd54fc5120ba2b6013f63f89b8e9da5",
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ]
  },
  "approve_file_handoff_oauth_binding": {
    "digest": "67327b9330e98e59ede68c50c194100f51835fc86219d4ad7d0b61c1d7ffaf8b",
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ]
  },
  "register_file_handoff_oauth_token": {
    "digest": "c8c97d086da48bd7e6b445dd77d55dcb73b95fbbc4858e79eb924c0d68b7cfc7",
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ]
  }
} as const;
export const fileTriggerFingerprints={
  "file_handoff_immutable": "1f5ed79b2f1c460ebe64f23946cbcff96afc1d47a9a214f47fa95a01e6419695",
  "file_handoff_command_immutable": "e4a27a61b0f6cdf218ec260d9ea2a16825945e5c162fcfa585bd08874016f726"
} as const;
export const fileNativeSessionFingerprint="99a4e5e0544c545449268dff2ccaf6f9e274a9b8470eed008f09b3500a49bca8";
