// Reviewed proposed0016 function bodies; update only with SQL qualification.
export const businessPolicySqlDigests = {
  "lifeos_agent.valid_personal_business_scopes(text[])": {
    "definer": false,
    "grantees": [],
    "digest": "8f78b8bffbb2e4cd75b435bc2d6dbcbc1dc7fe9af1c3f76a5b63aa36006580ba"
  },
  "lifeos_agent.business_policy_catalog()": {
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager",
      "lifeos_agent_verifier",
      "lifeos_platform_candidate_runtime"
    ],
    "digest": "392a45028daded1e9e37902e0c8cadcd9599b69e4265a16fc095b0150667aa42"
  },
  "lifeos_agent.current_managed_grant_digest(text)": {
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager"
    ],
    "digest": "bc1f6fb004bc518c31e1814ce5735e149eb2c8f4f82dfbcced1175bd1d823107"
  },
  "lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text)": {
    "definer": true,
    "grantees": [
      "lifeos_agent_key_manager"
    ],
    "digest": "886aa98215c0fcf1fd085b0a0b6d16d4e42ba02b8297da34e1891df9933f0058"
  },
  "lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)": {
    "definer": true,
    "grantees": [
      "lifeos_platform_candidate_runtime"
    ],
    "digest": "db4dd741bfcdd2abc1a2124eb3015f0e56e8f2319efd9e3730cbddd49da80a3b"
  }
} as const;
