function createCrimeFeature(deps) {
  return {
    addCrimeRating: deps.addCrimeRating,
    removeCrimeRating: deps.removeCrimeRating,
    addStars: deps.addStars,
    forceFiveStars: deps.forceFiveStars,
    policeWitnessReport: deps.policeWitnessReport,
    attachCrimeReputationToPlayer: deps.attachCrimeReputationToPlayer,
    loadCrimeReputationStore: deps.loadCrimeReputationStore,
    closeCrimeReputationStore: deps.closeCrimeReputationStore,
    onlineCrimeProfileIds: deps.onlineCrimeProfileIds,
  };
}

module.exports = {
  createCrimeFeature,
};
