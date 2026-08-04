# CGI Endpoint Builder — Agent Memory

- [Scenario-Profile binding pattern](project_scenario_profile_binding.md) — scenario_id in profile settings; activate.sh profile_managed guard; apply step order apn→ttl_hl→scenario→imei
- [/tmp cross-UID write rules](reference_tmp_cross_uid_write_rules.md) — fs.protected_regular blocks cross-UID writes both ways (root too); root:root 0666 only, and tmp+mv is forbidden for shared files
- [Root-only credentials move the send path too](reference_root_only_credentials_move_the_send_path.md) — email send_test runs msmtp inline as www-data; a 0700 secrets dir breaks it, and `[ -f <secret> ]` can't tell absent from forbidden
