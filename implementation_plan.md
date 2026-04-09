# Extract CompleteProfileModal to Fix Re-render Bug

The `CompleteProfileModal` is currently defined inside the `App` component's body. This causes the component to be re-created on every render of `App`, leading to loss of input focus and state resets.

## Proposed Changes

### [NEW] [CompleteProfileModal.jsx](file:///d:/Mis%20Documentos/Desktop/UnTroll/src/CompleteProfileModal.jsx)
- Create a new functional component using `React.memo`.
- Implement local state for `username` and `region`.
- Accept `onSave`, `onClose`, `initialUsername`, `initialRegion`, and `loading` as props.
- Include necessary styles (potentially passing them as classes or keeping them inline as they are now).

### [MODIFY] [App.jsx](file:///d:/Mis%20Documentos/Desktop/UnTroll/src/App.jsx)
- Import `CompleteProfileModal` from `./CompleteProfileModal`.
- Remove the inline `CompleteProfileModal` component definition.
- Remove `profileForm` usage for the modal (keep it for the Settings page or refactor the Settings page as well).
- Update the modal rendering logic to pass `handleUpdateProfile` as the `onSave` prop.

## Verification Plan

### Manual Verification
- Open the "Complete Profile" modal.
- Verify that typing in the "Summoner Name" field does not lose focus.
- Verify that the modal doesn't disappear/reappear unexpectedly.
- Confirm that saving correctly updates the user profile in Supabase.
