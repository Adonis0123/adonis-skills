# Language-Specific Patterns

## JavaScript/TypeScript

- Check for `await` without try-catch
- Verify Promise rejection handling
- Check for `console.log` in production code
- Validate async function error propagation
- Check for memory leaks in React (useEffect cleanup)

## Python

- Check for unhandled exceptions
- Verify proper context managers for resources
- Check for SQL injection in raw queries
- Validate type hints match implementation
- Check for mutable default arguments

## Java

- Check for unclosed resources (try-with-resources)
- Verify exception handling
- Check for SQL injection in JDBC
- Validate null safety
- Check for thread safety issues

## Go

- Check for unclosed defer statements
- Verify error returns are checked
- Check for goroutine leaks
- Validate context usage
- Check for race conditions

## SQL/Database

- Check for missing indexes on new queries
- Verify foreign key constraints
- Check for N+1 query patterns
- Validate transaction isolation levels
- Check for missing rollback on errors
