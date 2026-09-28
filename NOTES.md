# Notes

## Known issues

### Anyone can delete a franchise

**Where:** `DELETE /api/franchise/:franchiseId` in [src/routes/franchiseRouter.js](src/routes/franchiseRouter.js) (lines 96–104)

**Problem:** The delete-franchise route never checks who is calling it. Unlike the other routes that change data, it has no `authRouter.authenticateToken` middleware and no `Role.Admin` check. Anyone who can reach the service can delete any franchise without logging in, and deleting a franchise also removes its stores and its franchisee roles.

**Example:**

```sh
curl -X DELETE localhost:3000/api/franchise/1
# {"message":"franchise deleted"}
```

**Expected behavior:** Only an admin should be able to delete a franchise, the same as creating one. An anonymous request should get a 401, and a logged-in non-admin should get a 403.

**Test coverage:** The `close a franchise` test in [src/tests/franchise.test.js](src/tests/franchise.test.js) sends an admin token, so it passes whether or not the route checks auth. It does not catch this issue.

**Status:** Not fixed.
