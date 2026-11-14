// Exact prosrc hashes for the bounded migration; no authentication row reads.
export const sessionFreshnessPins=[
  {
    "signature": "lifeos_agent.verify_management_session(text,text,text)",
    "source": "0010_agent_key_management.proposed.sql",
    "sourceSha256": "12fc4c24e897c7aab19f893d0aa268b6876d89a28ddab0b5942b8799709b14c9",
    "oldBodyMd5": "d21da143975e04064d0d80ab5bbfa33a",
    "bodyMd5": "5d8cd42911fc47c996b45e1fdc812b0f"
  },
  {
    "signature": "lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)",
    "source": "0011_business_agent_grants.proposed.sql",
    "sourceSha256": "c2e97da459b30c70fdaacce74ac956ffe4731b259035d6d3359c66116ac6c388",
    "oldBodyMd5": "6039cdb8b2d3b7feeab995cfdadbd3a9",
    "bodyMd5": "d9e0020280c91668b229001462d99cbe",
    "delegatingBodyMd5": "e91104cb6c10c4fc612c55f9664a85f5"
  },
  {
    "signature": "lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text)",
    "source": "0016_all_personal_business_policy.proposed.sql",
    "sourceSha256": "879dca40aa0b129b37620cd80c89f3954611232c3f340cdb6e5484e9759d3c53",
    "oldBodyMd5": "85ea083ad65d226974ae19bbf6f599ed",
    "bodyMd5": "85bc02504d8c1e06af8209c1eddc5939"
  },
  {
    "signature": "lifeos_agent.oauth_business_owner_ready(text,text)",
    "source": "0021_business_mcp_oauth.proposed.sql",
    "sourceSha256": "63944bed3b384ed00b51ec05aa126600c7ad28bd7fff9836e44019a37d61d4ee",
    "oldBodyMd5": "876bbdc3249b34116603ddd7a694a728",
    "bodyMd5": "c7f6c54c1aebf780d5ff7f73b2dfdeb5"
  },
  {
    "signature": "lifeos_agent.set_file_handoff_permission(text,text,text,integer,text[],text)",
    "source": "0023_file_handoff_permissions.proposed.sql",
    "sourceSha256": "6af0c3bcbe11e6ed6496bd4746200a6365fb2cbef27fd2868e784b8a9be9e62d",
    "oldBodyMd5": "0f9fc9fe6e2400fbbc03a593f17ce09e",
    "bodyMd5": "730afda4fb7ada7c3594be377d17ba64"
  }
] as const;
