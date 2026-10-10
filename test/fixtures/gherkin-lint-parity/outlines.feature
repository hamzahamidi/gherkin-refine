Feature: Outlines

  Scenario Outline: no examples
    Given <x>

  Scenario Outline: empty table
    Given <x>
    Examples:
      | x |

  Scenario: has examples
    Given <x>
    Examples:
      | x |
      | 1 |

  Scenario:
    Given unnamed
