// Exact proposed0025 prosrc plus the unchanged0012 immutable guard. Not PG qualification.
export const policyOAuthSqlFingerprints={
  "lifeos_agent.valid_policy_oauth_scopes(text[])": {
    "definer": false,
    "grantees": [],
    "volatility": "i",
    "digest": "d5f24e9332e8773306a12368baab78ccbb674e098c697a1bfd895eb9cd370c4f"
  },
  "lifeos_agent.oauth_policy_original_ready(text,text,text)": {
    "definer": true,
    "grantees": [],
    "volatility": "v",
    "digest": "92b9a2c3f216d1cebbc8411bc61c8026dba561effd1993cec8c5348008f28cb2"
  },
  "lifeos_agent.oauth_policy_producer_revision(text,text,text,jsonb)": {
    "definer": true,
    "grantees": [],
    "volatility": "v",
    "digest": "929110a608b2946285fbe9747b19fdd16fb8f10f2807e55336e9ff7d3dea9ea1"
  },
  "lifeos_agent.read_policy_oauth_business_token(text,text,text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "e10984ea95567af842df9626435e170074f395bc1efb5403d9374932ade7c286"
  },
  "lifeos_agent.assert_oauth_classification_producer(text,text,text,jsonb,text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "157ccd4c1f2f004b53aed47c689f06eac5ae8ec9b0ff595bf987e65c54e065c8"
  },
  "lifeos_platform.classification_oauth_insert_binding()": {
    "definer": false,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "a935711276bdee8bcfc2325b6bc646ad30f0c5c490b209bf9e99ad824ec97311"
  },
  "lifeos_agent.approve_policy_oauth_business_binding(text,text,text,text,text,text[])": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "a6a9477d367ff65eaabab2aa1297354b52ed02d69e25067a58a1774569e98550"
  },
  "lifeos_agent.register_policy_oauth_business_token(text,text,text,text,jsonb,text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "60cc172637c4a0d1fe98704f33271ab0f80eb75e6109cda91a8ab5abd05d888a"
  },
  "lifeos_agent.assert_policy_oauth_business_grant(text,text,text,jsonb,text[],text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "776fb242664dbe132d724833b739a9f24e41b6cad64cc5ec527712b1db6beb95"
  },
  "lifeos_agent.oauth_policy_version()": {
    "definer": false,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "aa909dd366d3cdfc69fe782732e4942da94fed40a1654c5898271f16c5274fa8"
  },
  "lifeos_agent.oauth_policy_activation_ready(text,text,text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "a694b28f3ed832a702773ce55baa617ece2248d610f96b9157a1f5acc8fe93a2"
  },
  "lifeos_platform.classification_immutable()": {
    "definer": false,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "volatility": "v",
    "digest": "0e4afae79053fda94393778dad78188fe379cb4e71183da435b28d98a0a6c414"
  }
} as const;
