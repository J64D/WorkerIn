package br.com.workerin.ranking;

import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/matches")
public class RankingController {
    public record Candidate(String id, double distanceKm, double hourlyRate, List<String> skills, boolean available) {}
    public record Request(List<Candidate> candidates, List<String> requiredSkills, Double maxRate, Double maxDistanceKm) {}
    public record Ranked(String id, double score, List<String> matchingSkills, double distanceKm, double hourlyRate) {}

    @PostMapping("/rank")
    public Map<String, Object> rank(@RequestBody Request request) {
        var skills = request.requiredSkills() == null ? List.<String>of() : request.requiredSkills();
        var candidates = request.candidates() == null ? List.<Candidate>of() : request.candidates();
        var ranked = candidates.stream()
            .filter(Candidate::available)
            .filter(c -> request.maxRate() == null || c.hourlyRate() <= request.maxRate())
            .filter(c -> request.maxDistanceKm() == null || c.distanceKm() <= request.maxDistanceKm())
            .map(c -> {
                var matches = c.skills() == null ? List.<String>of() : skills.stream().filter(required -> c.skills().stream().anyMatch(actual -> actual.equalsIgnoreCase(required))).toList();
                double skillScore = skills.isEmpty() ? 1 : (double) matches.size() / skills.size();
                double distanceScore = request.maxDistanceKm() == null || request.maxDistanceKm() <= 0 ? 1 : Math.max(0, 1 - c.distanceKm() / request.maxDistanceKm());
                double priceScore = request.maxRate() == null || request.maxRate() <= 0 ? 1 : Math.max(0, 1 - c.hourlyRate() / request.maxRate());
                double score = Math.round((skillScore * .60 + distanceScore * .25 + priceScore * .15) * 1000.0) / 1000.0;
                return new Ranked(c.id(), score, matches, c.distanceKm(), c.hourlyRate());
            })
            .sorted(Comparator.comparingDouble(Ranked::score).reversed())
            .toList();
        return Map.of("results", ranked, "count", ranked.size());
    }
}
