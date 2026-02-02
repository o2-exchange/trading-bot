# Add API Endpoint: $ARGUMENTS

Add a new O2 API endpoint to the service layer.

## Steps

1. **Read the API service** for patterns:
   - `src/services/o2ApiService.ts` -- All existing endpoints, request/response types, header patterns

2. **Define request/response interfaces** in `src/services/o2ApiService.ts`:
   ```typescript
   export interface NewEndpointRequest {
     // Request body fields (snake_case to match API)
   }

   export interface NewEndpointResponse {
     // Response fields from API (snake_case)
   }
   ```

3. **Add the method** to the `O2ApiService` class:
   ```typescript
   async newEndpoint(request: NewEndpointRequest, ownerId: string): Promise<NewEndpointResponse> {
     const response = await this.client.post<NewEndpointResponse>('/endpoint-path', request, {
       headers: {
         'O2-Owner-Id': ownerId,  // B256 format required
       },
     })
     return response.data
   }
   ```

4. **Add type mapping** if the API response needs transformation to internal types:
   - Follow the `mapApiOrderToOrder()` pattern in `o2ApiService.ts`
   - Map snake_case API fields to camelCase internal types
   - Use `Decimal.js` for any numeric conversions

5. **Add internal types** in `src/types/` if needed.

6. **Wire up** in the appropriate service that will call this endpoint.

## Key Patterns

- **Authentication**: Include `O2-Owner-Id` header with B256-formatted address for authenticated endpoints
- **Rate limiting**: Handled automatically by the axios interceptor (429 retry with exponential backoff)
- **Error handling**: Let errors propagate to the caller -- the interceptor handles retries
- **API field naming**: O2 API uses `snake_case` for all fields
- **Internal field naming**: Internal types use `camelCase`

## O2 API Base URL

`https://api.o2.app/v1` (defined in `src/constants/o2Constants.ts` as `O2_API_URL`)

## Checklist

- [ ] Request interface defined with snake_case fields matching API
- [ ] Response interface defined
- [ ] Method added to `O2ApiService` class
- [ ] `O2-Owner-Id` header included for authenticated endpoints (B256 format)
- [ ] Response mapped to internal types if needed (snake_case -> camelCase)
- [ ] `Decimal.js` used for any price/quantity fields in mapping
- [ ] Internal types added in `src/types/` if introducing new data structures
