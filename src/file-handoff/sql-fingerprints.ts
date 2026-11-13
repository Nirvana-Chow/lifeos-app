// Proposed0022/0023 function bodies; requalify SQL/ACLs after changes.
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
  "read_file_handoff_permission": {
    "digest": "d2420b809a4a81fe71fc994bae81192f1e808a284389a976fbb2664e0ed4da90",
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
    "digest": "6ebc2ea5e05d36f786a1e0e16b40e860294c5ace188c24a1e5b7d82dd61ab906",
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager"
    ]
  },
  "assert_file_handoff_owner": {
    "digest": "7d63c3491f8ffbca7ab83ab26c3af9facca43413b8e20fdd3c84046433c1c7e4",
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
