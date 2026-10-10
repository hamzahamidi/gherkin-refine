@jira-12 @smoke
Feature: Patterns
  Draft notes here

  Background:
    Given a TODO step

  @smoke
  Scenario: todo later
    Given x
    When a
    And b
    When c

  @jira-3
  Scenario: fine
    When a
    Then b
    When c
