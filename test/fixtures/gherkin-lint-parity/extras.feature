Feature: A feature name that is deliberately much longer than the seventy character default

  @d @d
  Scenario Outline: Same name   
    Given a value <used> with a step text that is far longer than seventy characters overall
    Examples:
      | used | unused |
      | 1    | 2      |

  Scenario: Same name
    Given x
