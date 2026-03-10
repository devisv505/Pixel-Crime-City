export function createInputFeature(deps) {
  return {
    buildCurrentInputPayload: deps.buildCurrentInputPayload,
    sendInput: deps.sendInput,
    setKeyState: deps.setKeyState,
    handleActionKey: deps.handleActionKey,
  };
}
