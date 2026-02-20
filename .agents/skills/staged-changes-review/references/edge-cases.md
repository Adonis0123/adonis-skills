# Edge Cases and Optimizations

## Large File Changes

For files with >500 lines changed, focus on:
- Function signature changes
- Public API modifications
- Critical business logic

## Configuration Files

Pay extra attention to:
- Environment-specific settings
- Security configurations
- Service endpoint changes
- Feature flags

## Dependency Changes

When package.json/requirements.txt/go.mod changes:
- Check for major version bumps
- Review CHANGELOG of updated packages
- Identify deprecated APIs being used

## Test File Changes

Ensure:
- Tests are not being deleted without reason
- New features have corresponding tests
- Test assertions are meaningful

## Performance Optimization

For repositories with many staged files (>20):
1. Prioritize files by type (critical business logic first)
2. Focus on .js/.ts/.py/.java files over config/doc files
3. Skip generated files (dist/, build/, lock files)
4. Batch similar files for pattern detection

## When Not to Use This Skill

This skill is **not** needed for:
- Reviewing already committed changes (use git log/show)
- Comparing branches (use git diff branch1..branch2)
- Reviewing specific files not staged
- General code review without staged context
